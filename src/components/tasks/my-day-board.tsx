'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { AlertOctagon, Calendar, Eye, Play, ExternalLink, CheckCircle2 } from 'lucide-react'
import { DueDateChip } from '@/components/ui/due-date-chip'

const PRIORITY_DOT: Record<string, string> = {
  very_high: 'bg-danger', high: 'bg-signal-ink', medium: 'bg-signal-ink', low: 'bg-success', very_low: 'bg-stone',
}

/**
 * "Mi día" — personal today-focused board for the logged-in user.
 *
 * 4 columns:
 *   - Vencidas       (red, urgent)
 *   - Vence HOY      (cyan, primary focus)
 *   - En progreso    (amber, work I'm already on)
 *   - Para revisar   (purple, items where I'm the reviewer awaiting my sign-off)
 *
 * Only shows tasks where the current user is assignee OR reviewer.
 * Empty state guides: "todo al día — andate tranquilo a hacer otra cosa".
 */
export function MyDayBoard() {
  // Poll every 30 s — Mi día is THE view people leave open all day.
  const { data, isLoading } = trpc.tasks.myDay.useQuery(undefined, { refetchInterval: 30_000 })

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-48 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />)}
      </div>
    )
  }

  const totalCount = (data?.dueToday.length ?? 0) + (data?.overdue.length ?? 0) + (data?.inProgress.length ?? 0) + (data?.reviewing.length ?? 0)
  if (!data || totalCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-success/50 bg-success-wash/40 p-12 text-center dark:border-success/40 dark:bg-success/20">
        <CheckCircle2 className="mx-auto h-9 w-9 text-success" />
        <p className="mt-3 text-base font-semibold text-success dark:text-success/30">¡Todo al día!</p>
        <p className="mt-1 text-sm text-success/80 dark:text-success/50/80">
          Sin tareas vencidas, ni de hoy, ni en progreso, ni esperando tu revisión. Puedes irte tranquilo.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Column
        title="Vencidas"
        sub="Estaban para ayer o antes"
        icon={<AlertOctagon className="h-3.5 w-3.5" />}
        tone="rose"
        items={data.overdue}
      />
      <Column
        title="Vence HOY"
        sub="Foco del día"
        icon={<Calendar className="h-3.5 w-3.5" />}
        tone="cyan"
        items={data.dueToday}
      />
      <Column
        title="En progreso"
        sub="Ya las arrancaste"
        icon={<Play className="h-3.5 w-3.5" />}
        tone="amber"
        items={data.inProgress}
      />
      <Column
        title="Para revisar"
        sub="Esperan tu sign-off"
        icon={<Eye className="h-3.5 w-3.5" />}
        tone="purple"
        items={data.reviewing}
      />
    </div>
  )
}

type Task = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  drive_url: string | null
  review_state: string | null
  reviewer_id: string | null
  project: { id: string; code: string; name: string; color: string } | null
}

function Column({
  title, sub, icon, tone, items,
}: {
  title: string
  sub: string
  icon: React.ReactNode
  tone: 'rose' | 'cyan' | 'amber' | 'purple'
  items: Task[]
}) {
  const toneClasses = {
    rose:   { card: 'border-danger/30 bg-danger-wash/50 dark:border-danger/40 dark:bg-danger/20',     icon: 'bg-danger text-white',   header: 'text-danger dark:text-danger/50' },
    cyan:   { card: 'border-stone bg-signal-wash/50 dark:border-signal/40 dark:bg-signal/20',     icon: 'bg-night text-white',   header: 'text-night dark:text-signal' },
    amber:  { card: 'border-signal/30 bg-signal-wash/50 dark:border-signal-ink/40 dark:bg-signal/20', icon: 'bg-signal-ink text-white',  header: 'text-signal-ink dark:text-signal/50' },
    purple: { card: 'border-purple-200 bg-purple-50/50 dark:border-purple-900/40 dark:bg-purple-950/20', icon: 'bg-purple-600 text-white', header: 'text-purple-800 dark:text-purple-300' },
  }[tone]

  return (
    <section className={cn('rounded-xl border p-4', toneClasses.card)}>
      <header className="mb-3 flex items-center gap-2.5">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', toneClasses.icon)}>{icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className={cn('text-sm font-semibold', toneClasses.header)}>{title}</h2>
          <p className="text-[10px] uppercase tracking-wider text-graphite">{sub}</p>
        </div>
        <span className="rounded-md bg-white/70 px-2 py-0.5 text-xs font-bold tabular-nums text-ink-body dark:bg-night/60 dark:text-stone">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-graphite italic">—</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(t => (
            <li key={t.id} className="rounded-lg bg-white/80 p-2.5 shadow-sm transition hover:bg-white dark:bg-night/60">
              <div className="flex items-start gap-2">
                <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={t.project ? `/dashboard/projects/${t.project.id}` : '#'}
                    className="block text-sm font-medium text-night-700 hover:text-night dark:text-stone dark:hover:text-signal"
                  >
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-graphite flex-wrap">
                    {t.project && (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.project.color }} />
                        {t.project.code}
                      </span>
                    )}
                    {t.due_date && (
                      <>
                        <span>·</span>
                        <DueDateChip date={t.due_date} isDone={t.status === 'done' || t.status === 'canceled'} compact />
                      </>
                    )}
                    {t.drive_url && (
                      <a
                        href={t.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 rounded bg-stone-100 px-1.5 py-0.5 text-signal-ink hover:bg-signal-wash dark:bg-night-700"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink className="h-2.5 w-2.5" /> doc
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
