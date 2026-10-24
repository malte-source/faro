'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { AlertTriangle, Calendar, CheckSquare, Sliders } from 'lucide-react'

/**
 * Capacity / Workload board with two complementary modes:
 *
 *   1. "Reuniones" — % of work hours busy in Google Calendar. Calls
 *      `calendar.capacity`. Shows reality from the meeting side.
 *   2. "Tareas estimadas" — sum of `estimated_hours` of open tasks due
 *      each week per person, vs a configurable weekly capacity (default 40h).
 *      Calls `team.workloadTasks`. Shows promised delivery load.
 *
 * Both views answer "who's overloaded?" but from different angles. PMs
 * usually want BOTH (someone with 20h of meetings AND 30h of tasks due
 * this week is *also* drowning — even if neither metric alone flags red).
 */
type Mode = 'meetings' | 'tasks'

export function CapacityBoard() {
  const [mode, setMode] = useState<Mode>('tasks')

  return (
    <div>
      {/* Mode toggle */}
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-stone bg-white p-0.5 dark:border-ink-body dark:bg-night">
          <button
            onClick={() => setMode('tasks')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'tasks' ? 'bg-night text-white' : 'text-graphite hover:text-ink-body dark:text-graphite'} dark:bg-signal dark:text-night max-md:h-10 max-md:px-4 max-md:text-sm`}
            title="Carga calculada por horas estimadas de tareas con due_date en cada semana"
          >
            <CheckSquare className="h-3.5 w-3.5" /> Tareas estimadas
          </button>
          <button
            onClick={() => setMode('meetings')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'meetings' ? 'bg-night text-white' : 'text-graphite hover:text-ink-body dark:text-graphite'} dark:bg-signal dark:text-night max-md:h-10 max-md:px-4 max-md:text-sm`}
            title="% de horas laborales ocupadas por reuniones de Google Calendar"
          >
            <Calendar className="h-3.5 w-3.5" /> Reuniones (Calendar)
          </button>
        </div>
        <p className="ml-auto text-[10px] text-graphite">
          {mode === 'tasks'
            ? 'Suma de horas estimadas de tareas activas con due_date en cada semana'
            : '% de horas laborales (9–18 L-V) con reuniones en Google Calendar'}
        </p>
      </div>

      {mode === 'tasks' ? <TasksView /> : <MeetingsView />}
    </div>
  )
}

// ─── Tasks view (new) ─────────────────────────────────────────────────

function TasksView() {
  const [weeksOut, setWeeksOut] = useState(6)
  const [capacityHours, setCapacityHours] = useState(40)
  const { data, isLoading, error } = trpc.team.workloadTasks.useQuery({ weeksOut, capacityHours })

  if (isLoading) return <div className="h-72 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />
  if (error) return (
    <div className="rounded-xl border border-danger/30 bg-danger-wash/60 p-4 text-sm text-danger dark:border-danger/40 dark:bg-danger/20 dark:text-danger/50">
      <AlertTriangle className="mr-1 inline h-4 w-4" /> {error.message}
    </div>
  )
  if (!data || !data.users.length) return <p className="text-sm text-graphite">Sin miembros en la organización.</p>

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-graphite">
        <span>Ventana:</span>
        {[4, 6, 12].map(n => (
          <button
            key={n}
            onClick={() => setWeeksOut(n)}
            className={`flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium md:h-auto md:rounded-md md:px-2 md:py-0.5 md:text-xs ${weeksOut === n ? 'bg-night text-mist dark:bg-signal dark:text-night' : 'bg-border-soft text-graphite'}`}
          >
            {n} sem.
          </button>
        ))}
        <span className="ml-3 inline-flex items-center gap-1 text-graphite">
          <Sliders className="h-3 w-3" /> Capacidad semanal:
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={80}
          value={capacityHours}
          onChange={e => setCapacityHours(Math.max(1, Math.min(80, parseInt(e.target.value) || 40)))}
          className="h-9 w-16 rounded-lg border border-stone bg-white px-2 text-base dark:border-ink-body dark:bg-night-700 md:h-auto md:w-14 md:rounded md:px-1.5 md:py-0.5 md:text-xs"
        />
        <span>h</span>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-graphite">
          <LegendDot pct={20} /> Holgura
          <LegendDot pct={60} /> Ocupado
          <LegendDot pct={95} /> Saturado
          <LegendDot pct={110} /> Sobrecarga
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-100 bg-mist/50 dark:border-night-700 dark:bg-night-700/40">
              <th className="sticky left-0 z-10 bg-mist px-3 py-2 text-left font-semibold text-graphite dark:bg-night-700 dark:text-stone">Miembro</th>
              {data.weeks.map(w => (
                <th key={w.start} className="px-2 py-2 text-center font-semibold text-graphite dark:text-stone">
                  {w.label}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold text-graphite dark:text-stone">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u, ui) => {
              const rowTotal = data.grid[ui].reduce((a, b) => a + b, 0)
              return (
                <tr key={u.id} className="border-b border-stone-100 last:border-0 dark:border-night-700">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-night">
                    <div className="flex items-center gap-2">
                      {u.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-[10px] font-semibold text-graphite dark:bg-ink-body">
                          {(u.name ?? '?').slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink-body dark:text-stone">{u.name}</p>
                        {u.position && <p className="text-[9px] text-graphite truncate">{u.position}</p>}
                      </div>
                    </div>
                  </td>
                  {data.weeks.map((w, wi) => {
                    const hours = data.grid[ui]?.[wi] ?? 0
                    const pct = Math.round((hours / data.capacityHours) * 100)
                    return (
                      <td key={w.start} className="px-1 py-1.5 text-center">
                        <WorkloadCell hours={hours} pct={pct} />
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-center">
                    <span className="rounded-md bg-stone-100 px-2 py-1 text-[11px] font-bold tabular-nums text-ink-body dark:bg-night-700 dark:text-stone">
                      {rowTotal}h
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-graphite">
        {data.totalTasksConsidered} tareas activas · {data.totalHours}h total en los próximos {data.daysSpanned} días.
        Para tareas sin <code className="font-mono">estimated_hours</code> seteado asumimos 2h como heurística.
      </p>
    </div>
  )
}

function WorkloadCell({ hours, pct }: { hours: number; pct: number }) {
  if (hours === 0) {
    return <div className="mx-auto h-9 w-12 rounded-md bg-stone-100 dark:bg-night-700" />
  }
  return (
    <div
      className="mx-auto flex h-9 w-12 flex-col items-center justify-center rounded-md text-[10px] font-bold leading-none text-white"
      style={{ background: colorForPct(pct) }}
      title={`${hours} horas estimadas · ${pct}% de la capacidad`}
    >
      <span className="text-[11px]">{hours}h</span>
      <span className="text-[8px] opacity-80">{pct}%</span>
    </div>
  )
}

// ─── Meetings view (existing) ────────────────────────────────────────

function MeetingsView() {
  const [windowDays, setWindowDays] = useState(7)
  const { data, isLoading, error } = trpc.calendar.capacity.useQuery({ windowDays })

  if (isLoading) return <div className="h-72 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />
  if (error) return (
    <div className="rounded-xl border border-danger/30 bg-danger-wash/60 p-4 text-sm text-danger dark:border-danger/40 dark:bg-danger/20 dark:text-danger/50">
      <AlertTriangle className="mr-1 inline h-4 w-4" /> {error.message}
    </div>
  )
  if (!data || !data.users.length) return <p className="text-sm text-graphite">Sin miembros en la organización.</p>
  if ('error' in data && data.error) return (
    <div className="rounded-xl border border-signal/30 bg-signal-wash/60 p-4 text-sm text-signal-ink dark:border-signal-ink/40 dark:bg-signal/20 dark:text-signal/50">
      <AlertTriangle className="mr-1 inline h-4 w-4" /> No se pudo leer Calendar: {data.error}
    </div>
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-graphite">
        <span>Ventana:</span>
        {[7, 14].map(n => (
          <button
            key={n}
            onClick={() => setWindowDays(n)}
            className={`flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium md:h-auto md:rounded-md md:px-2 md:py-0.5 md:text-xs ${windowDays === n ? 'bg-night text-mist dark:bg-signal dark:text-night' : 'bg-border-soft text-graphite'}`}
          >
            {n} días
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-graphite">
          <LegendDot pct={10} /> Libre
          <LegendDot pct={45} /> Ocupado
          <LegendDot pct={85} /> Saturado
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-100 bg-mist/50 dark:border-night-700 dark:bg-night-700/40">
              <th className="sticky left-0 z-10 bg-mist px-3 py-2 text-left font-semibold text-graphite dark:bg-night-700 dark:text-stone">Miembro</th>
              {data.days.map(d => (
                <th key={d.iso} className="px-2 py-2 text-center font-semibold text-graphite dark:text-stone">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.users.map((u, ui) => (
              <tr key={u.id} className="border-b border-stone-100 last:border-0 dark:border-night-700">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-night">
                  <div className="flex items-center gap-2">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-[10px] font-semibold text-graphite dark:bg-ink-body">
                        {(u.name ?? '?').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium text-ink-body dark:text-stone">{u.name ?? u.email}</span>
                  </div>
                </td>
                {data.days.map((d, di) => {
                  const pct = data.grid[ui]?.[di] ?? 0
                  return (
                    <td key={d.iso} className="px-1 py-1.5 text-center">
                      <CapacityCell pct={pct} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LegendDot({ pct }: { pct: number }) {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForPct(pct) }} />
}

function CapacityCell({ pct }: { pct: number }) {
  return (
    <div
      className="mx-auto flex h-9 w-12 items-center justify-center rounded-md text-[11px] font-bold text-white"
      style={{ background: colorForPct(pct) }}
    >
      {pct}%
    </div>
  )
}

/** Smooth green → amber → red scale tied to percentage. Goes >100% for overload. */
function colorForPct(pct: number): string {
  if (pct < 25) return '#10b981'    // success
  if (pct < 50) return '#84cc16'    // lime-500
  if (pct < 75) return '#f59e0b'    // signal-ink
  if (pct < 90) return '#f97316'    // signal-ink
  if (pct <= 100) return '#ef4444'  // danger
  return '#991b1b'                  // danger — overload
}
