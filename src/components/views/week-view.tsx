'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { ChevronLeft, ChevronRight, Calendar, GripVertical } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { SwipeRow } from '@/components/mobile/swipe-row'
import { haptic } from '@/components/mobile/haptics'
import { Check, CalendarClock } from 'lucide-react'

/**
 * Weekly task view — 7 columns Mon→Sun for a target week. Each column shows
 * the tasks whose due_date falls on that day. Drag a card to another column
 * to reschedule (mutates due_date).
 *
 * Design choices:
 *  - Time-zone aware: the week is computed from the user's TZ (the back-end
 *    returns due_date as YYYY-MM-DD already in their TZ so we just bucket
 *    by string equality).
 *  - "Mine only" toggle: defaults ON (your week). Toggle OFF to see the
 *    team's week — useful for managers.
 *  - "Include done" toggle: defaults ON so you can see what got finished.
 *  - Drag-and-drop uses HTML5 dragstart/dragover/drop — no library. Touch
 *    devices fall back to a long-press menu (TODO later).
 *  - Empty days show a soft "Nada planificado" hint so the column doesn't
 *    look broken.
 */

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mondayOf(d: Date): Date {
  const copy = new Date(d)
  const dow = copy.getDay() // 0=Sun
  const offsetToMon = (dow + 6) % 7
  copy.setDate(copy.getDate() - offsetToMon)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function addDaysDate(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

const PRIO_COLOR: Record<string, string> = {
  very_high: 'bg-danger',
  high: 'bg-signal-ink',
  medium: 'bg-signal-ink',
  low: 'bg-stone',
  very_low: 'bg-stone',
}

export function WeekView() {
  // Anchor: any date inside the visible week. Default = today.
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [mineOnly, setMineOnly] = useState(true)
  const [includeDone, setIncludeDone] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [selectedISO, setSelectedISO] = useState<string | null>(null)

  const monday = useMemo(() => mondayOf(anchor), [anchor])
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysDate(monday, i)),
    [monday]
  )
  const isoFrom = formatISODate(days[0])
  const isoTo = formatISODate(days[6])
  const todayISO = formatISODate(new Date())

  const utils = trpc.useUtils()
  const { data: tasks, isLoading } = trpc.tasks.byDateRange.useQuery({
    from: isoFrom,
    to: isoTo,
    mineOnly,
    includeDone,
  })

  const reschedule = trpc.tasks.reschedule.useMutation({
    onSuccess: () => {
      utils.tasks.byDateRange.invalidate()
      utils.tasks.invalidate()
    },
    onError: e => toast.error('No se pudo mover la tarea', e.message),
  })

  // Bucket tasks by ISO day string.
  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tasks>>()
    for (const d of days) map.set(formatISODate(d), [])
    for (const t of tasks ?? []) {
      if (!t.due_date) continue
      const list = map.get(t.due_date)
      if (list) list.push(t)
    }
    return map
  }, [tasks, days])

  function handleDrop(targetISO: string) {
    if (!dragId) return
    const task = (tasks ?? []).find(t => t.id === dragId)
    setDragId(null)
    if (!task || task.due_date === targetISO) return
    reschedule.mutate({ taskId: dragId, newDueDate: targetISO })
  }

  const monthLabel = monday.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  // Phone: the agenda always shows one day of the visible week (today when it's in view, else Monday).
  const activeISO = selectedISO && days.some(d => formatISODate(d) === selectedISO)
    ? selectedISO
    : days.some(d => formatISODate(d) === todayISO) ? todayISO : isoFrom
  const activeItems = byDay.get(activeISO) ?? []
  const activeLabel = new Date(activeISO + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  const tomorrowISO = formatISODate(addDaysDate(new Date(activeISO + 'T12:00:00'), 1))

  const complete = trpc.tasks.update.useMutation({
    onSuccess: () => { utils.tasks.byDateRange.invalidate(); utils.tasks.invalidate() },
    onError: e => toast.error('No se pudo completar la tarea', e.message),
  })

  return (
    <>
    {/* ═════════ Phone: day strip + agenda ═════════ */}
    <div className="md:hidden">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[22px] font-extrabold capitalize tracking-[-0.035em] text-foreground">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { haptic(); setAnchor(d => addDaysDate(d, -7)); setSelectedISO(null) }} aria-label="Semana anterior" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => { haptic(); setAnchor(new Date()); setSelectedISO(null) }} className="h-8 rounded-full bg-border-soft px-3 text-[13px] font-semibold text-foreground active:bg-border">Hoy</button>
          <button type="button" onClick={() => { haptic(); setAnchor(d => addDaysDate(d, 7)); setSelectedISO(null) }} aria-label="Semana siguiente" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" data-no-ptr>
        {days.map((d, i) => {
          const iso = formatISODate(d)
          const count = byDay.get(iso)?.length ?? 0
          const isToday = iso === todayISO
          const isActive = iso === activeISO
          return (
            <button
              key={iso}
              type="button"
              onClick={() => { haptic(); setSelectedISO(iso) }}
              aria-pressed={isActive}
              aria-label={`${DAY_LABELS[i]} ${d.getDate()}, ${count} tareas`}
              className="flex flex-col items-center gap-1 rounded-[14px] py-1.5 active:bg-border-soft"
            >
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{DAY_LETTERS[i]}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[16px] font-semibold tabular-nums transition-colors ${
                isToday && isActive ? 'bg-signal font-bold text-night'
                : isToday ? 'bg-signal/25 font-bold text-foreground'
                : isActive ? 'bg-night text-mist dark:bg-foreground dark:text-night'
                : 'text-foreground'
              }`}>{d.getDate()}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? 'bg-signal-ink' : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {([['Solo mías', mineOnly, setMineOnly], ['Incluir hechas', includeDone, setIncludeDone]] as const).map(([label, on, set]) => (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => { haptic(); set(!on) }}
            className={`h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${on ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night' : 'border-border bg-surface text-graphite'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mt-5 px-1 font-display text-[17px] font-extrabold capitalize tracking-[-0.03em] text-foreground">{activeLabel}</p>
      <div className="mt-2">
        {isLoading ? (
          <div className="h-[60px] animate-pulse rounded-[14px] bg-border-soft" />
        ) : activeItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border py-10 text-graphite">
            <Calendar className="mb-2 h-6 w-6" />
            <p className="text-sm">Nada planificado este día</p>
          </div>
        ) : (
          <InsetGroup footer="Desliza una tarea hacia la izquierda: Hecha o pasarla a mañana.">
            {activeItems.map(t => (
              <SwipeRow
                key={t.id}
                actions={[
                  { label: 'Hecha', tone: 'success', icon: <Check className="h-5 w-5" />, onTrigger: () => complete.mutate({ id: t.id, status: 'done' }) },
                  { label: 'Mañana', tone: 'signal', icon: <CalendarClock className="h-5 w-5" />, onTrigger: () => reschedule.mutate({ taskId: t.id, newDueDate: tomorrowISO }) },
                ]}
              >
                <ListRow
                  href={`/dashboard/tasks?taskId=${t.id}`}
                  leading={<span className={`h-2.5 w-2.5 rounded-full ${PRIO_COLOR[t.priority] ?? 'bg-stone'}`} />}
                  title={<span className={t.status === 'done' ? 'line-through opacity-60' : ''}>{t.title}</span>}
                  subtitle={t.project ? <span><span style={{ color: t.project.color }}>●</span> {t.project.code}</span> : undefined}
                />
              </SwipeRow>
            ))}
          </InsetGroup>
        )}
      </div>
    </div>

    {/* ═════════ Desktop ═════════ */}
    <div className="mx-auto hidden max-w-7xl md:block">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnchor(d => addDaysDate(d, -7))}
            className="rounded-md border border-stone p-1.5 text-graphite transition-colors hover:bg-mist hover:text-body dark:border-ink-body dark:hover:bg-night-700"
            title="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink-body transition-colors hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
          >
            Hoy
          </button>
          <button
            onClick={() => setAnchor(d => addDaysDate(d, 7))}
            className="rounded-md border border-stone p-1.5 text-graphite transition-colors hover:bg-mist hover:text-body dark:border-ink-body dark:hover:bg-night-700"
            title="Semana siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 text-sm font-semibold text-ink-body capitalize dark:text-stone">
            {monthLabel}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-graphite dark:text-stone">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={e => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-signal"
            />
            Solo mías
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-graphite dark:text-stone">
            <input
              type="checkbox"
              checked={includeDone}
              onChange={e => setIncludeDone(e.target.checked)}
              className="h-3.5 w-3.5 accent-signal"
            />
            Incluir hechas
          </label>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {days.map((d, i) => {
          const iso = formatISODate(d)
          const items = byDay.get(iso) ?? []
          const isToday = iso === todayISO
          const isWeekend = i >= 5
          return (
            <div
              key={iso}
              onDragOver={e => { e.preventDefault() }}
              onDrop={() => handleDrop(iso)}
              className={`flex min-h-[200px] flex-col rounded-xl border bg-white p-2 dark:bg-night transition-colors ${
                isToday
                  ? 'border-signal ring-1 ring-signal'
                  : isWeekend
                    ? 'border-stone-100 bg-mist/40 dark:border-night-700 dark:bg-night/50'
                    : 'border-stone dark:border-ink-body'
              } ${dragId ? 'hover:bg-signal-wash/30 dark:hover:bg-signal/10' : ''}`}
            >
              <div className="mb-2 flex items-baseline justify-between border-b border-stone-100 pb-1.5 dark:border-night-700">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-signal-ink' : 'text-graphite'}`}>
                  {DAY_LABELS[i]}
                </span>
                <span className={`text-sm font-semibold ${isToday ? 'text-signal-ink' : 'text-ink-body dark:text-stone'}`}>
                  {d.getDate()}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-1.5">
                {isLoading && <div className="h-12 animate-pulse rounded-md bg-stone-100 dark:bg-night-700" />}
                {!isLoading && items.length === 0 && (
                  <p className="mt-2 text-center text-[10px] text-stone dark:text-graphite">
                    Nada planificado
                  </p>
                )}
                {items.map(t => (
                  <Link
                    key={t.id}
                    href={`/dashboard/tasks?taskId=${t.id}`}
                    draggable
                    onDragStart={e => { setDragId(t.id); e.dataTransfer.setData('text/plain', t.id) }}
                    onDragEnd={() => setDragId(null)}
                    className={`group flex items-start gap-1.5 rounded-md border border-stone-100 bg-white px-2 py-1.5 text-[11px] transition-all hover:border-stone hover:shadow-sm dark:border-ink-body dark:bg-night-700 ${
                      t.status === 'done' ? 'opacity-60' : ''
                    } ${dragId === t.id ? 'opacity-40' : ''}`}
                  >
                    <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-stone md:opacity-0 transition-opacity md:group-hover:opacity-100" />
                    <span
                      className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${PRIO_COLOR[t.priority] ?? 'bg-stone'}`}
                      title={t.priority}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium text-night dark:text-stone-100 ${t.status === 'done' ? 'line-through' : ''}`}>
                        {t.title}
                      </p>
                      {t.project && (
                        <p className="truncate text-[10px] text-graphite">
                          <span style={{ color: t.project.color }}>●</span> {t.project.code}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-center text-[10px] text-graphite">
        <Calendar className="mr-1 inline h-3 w-3" />
        Arrastra una tarea a otro día para reagendarla.
      </p>
    </div>
    </>
  )
}
