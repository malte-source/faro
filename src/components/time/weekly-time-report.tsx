'use client'

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Clock, Users } from 'lucide-react'

function fmtHours(minutes: number): string {
  const h = minutes / 60
  return h >= 10 ? `${h.toFixed(0)} hs` : `${h.toFixed(1)} hs`
}

/**
 * Weekly time-tracking report — total horas by user and by project for
 * the current week. Shown on the /dashboard/reports page below the digest.
 */
export function WeeklyTimeReport() {
  const { data, isLoading } = trpc.time.weeklySummary.useQuery({})

  const maxUser = useMemo(() => Math.max(...(data?.byUser ?? []).map(u => u.minutes), 1), [data])
  const maxProj = useMemo(() => Math.max(...(data?.byProject ?? []).map(p => p.minutes), 1), [data])

  if (isLoading) {
    return (
      <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
        <div className="h-5 w-40 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
        <div className="mt-4 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-8 text-center dark:border-ink-body dark:bg-night">
        <Clock className="mx-auto h-7 w-7 text-stone" />
        <p className="mt-2 text-sm text-graphite">Sin tiempo registrado esta semana.</p>
        <p className="mt-1 text-xs text-graphite">Inicia un timer desde cualquier tarea para empezar.</p>
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <header className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Clock className="h-4 w-4 text-signal-ink" />
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-night dark:text-stone-100">
            Tiempo registrado esta semana
          </h2>
          <p className="text-[10px] uppercase tracking-wider text-graphite">
            Semana del {new Date(data.weekStart).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold tabular-nums text-night dark:text-stone-100">
            {fmtHours(data.total)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-graphite">total org</p>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {/* By user */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-graphite">
            <Users className="h-3 w-3" /> Por persona
          </p>
          <ul className="space-y-1.5">
            {data.byUser.map(u => (
              <li key={u.id} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-ink-body dark:text-stone">{u.name}</span>
                  <span className="font-mono tabular-nums text-graphite">{fmtHours(u.minutes)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                  <div
                    className="h-full rounded-full bg-signal"
                    style={{ width: `${(u.minutes / maxUser) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* By project */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-graphite">
            Por proyecto
          </p>
          <ul className="space-y-1.5">
            {data.byProject.map(p => (
              <li key={p.id} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="truncate text-ink-body dark:text-stone">{p.code} {p.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-graphite">{fmtHours(p.minutes)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(p.minutes / maxProj) * 100}%`, backgroundColor: p.color }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
