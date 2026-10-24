'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { haptic } from '@/components/mobile/haptics'

/**
 * Monthly calendar grid (Mon-first). Each cell shows up to N task pills
 * coloured by project; overflow collapses to "+X more".
 *
 * Design choices:
 *  - Mon-first because South America convention (matches WeekView).
 *  - Past months are dimmer — visual cue that you're looking at history.
 *  - Click a pill → open task in the global tasks page with that task pinned.
 *  - Click a day cell (not a pill) → opens that day's items in a flyout.
 *    We skip the flyout for now and use a click-through to /week with that
 *    anchor instead — fewer custom widgets, similar UX.
 *  - Drag-drop is intentionally NOT supported on month view (cells are too
 *    small + screen real estate is precious). Use /week for that.
 */

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MAX_VISIBLE_PER_CELL = 3

function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfMonthGrid(anchor: Date): Date {
  // First day of the month, then walk back to the previous Monday.
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const dow = first.getDay() // 0=Sun
  const offsetToMon = (dow + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offsetToMon)
  start.setHours(0, 0, 0, 0)
  return start
}

function addDaysDate(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

export function MonthView() {
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [mineOnly, setMineOnly] = useState(true)
  const [includeDone, setIncludeDone] = useState(true)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [selectedISO, setSelectedISO] = useState<string | null>(null)

  const gridStart = useMemo(() => startOfMonthGrid(anchor), [anchor])
  // 6 rows × 7 days = 42 cells; enough for any month.
  const cells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDaysDate(gridStart, i)),
    [gridStart]
  )
  const isoFrom = formatISODate(cells[0])
  const isoTo = formatISODate(cells[cells.length - 1])
  const todayISO = formatISODate(new Date())
  const currentMonth = anchor.getMonth()

  const { data: tasks, isLoading } = trpc.tasks.byDateRange.useQuery({
    from: isoFrom,
    to: isoTo,
    mineOnly,
    includeDone,
  })

  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tasks>>()
    for (const c of cells) map.set(formatISODate(c), [])
    for (const t of tasks ?? []) {
      if (!t.due_date) continue
      const list = map.get(t.due_date)
      if (list) list.push(t)
    }
    return map
  }, [tasks, cells])

  const monthLabel = anchor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  // Phone: compact grid + agenda of the chosen day (today, or the 1st when browsing another month).
  const now = new Date()
  const inThisMonth = anchor.getFullYear() === now.getFullYear() && anchor.getMonth() === now.getMonth()
  const activeISO = selectedISO && byDay.has(selectedISO)
    ? selectedISO
    : inThisMonth ? todayISO : formatISODate(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const activeItems = byDay.get(activeISO) ?? []
  const activeLabel = new Date(activeISO + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  const goMonth = (delta: number) => { haptic(); setAnchor(d => new Date(d.getFullYear(), d.getMonth() + delta, 1)); setSelectedISO(null) }

  return (
    <>
    {/* ═════════ Phone ═════════ */}
    <div className="md:hidden">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[22px] font-extrabold capitalize tracking-[-0.035em] text-foreground">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => goMonth(-1)} aria-label="Mes anterior" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => { haptic(); setAnchor(new Date()); setSelectedISO(null) }} className="h-8 rounded-full bg-border-soft px-3 text-[13px] font-semibold text-foreground active:bg-border">Hoy</button>
          <button type="button" onClick={() => goMonth(1)} aria-label="Mes siguiente" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-7 text-center" aria-hidden>
        {DAY_LETTERS.map(l => (
          <span key={l} className="py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{l}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1" data-no-ptr>
        {cells.map(d => {
          const iso = formatISODate(d)
          const items = byDay.get(iso) ?? []
          const isToday = iso === todayISO
          const isActive = iso === activeISO
          const inMonth = d.getMonth() === currentMonth
          const colors = Array.from(new Set(items.map(t => t.project?.color ?? '#8B99A2'))).slice(0, 3)
          return (
            <button
              key={iso}
              type="button"
              onClick={() => { haptic(); setSelectedISO(iso) }}
              aria-pressed={isActive}
              aria-label={`${d.getDate()} de ${d.toLocaleDateString('es', { month: 'long' })}, ${items.length} tareas`}
              className={`flex h-[52px] flex-col items-center justify-start gap-0.5 pt-1 ${inMonth ? '' : 'opacity-40'}`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-medium tabular-nums transition-colors ${
                isToday && isActive ? 'bg-signal font-bold text-night'
                : isToday ? 'bg-signal/25 font-bold text-foreground'
                : isActive ? 'bg-night font-semibold text-mist dark:bg-foreground dark:text-night'
                : 'text-foreground'
              }`}>{d.getDate()}</span>
              <span className="flex h-1.5 items-center gap-[3px]">
                {colors.map(c => <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />)}
              </span>
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
          <p className="rounded-[14px] border border-dashed border-border py-8 text-center text-sm text-graphite">Nada planificado este día</p>
        ) : (
          <InsetGroup>
            {activeItems.map(t => (
              <ListRow
                key={t.id}
                href={`/dashboard/tasks?taskId=${t.id}`}
                leading={<span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.project?.color ?? '#8B99A2' }} />}
                title={<span className={t.status === 'done' ? 'line-through opacity-60' : ''}>{t.title}</span>}
                subtitle={t.project ? `${t.project.code} · ${t.project.name}` : undefined}
              />
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
            onClick={() => setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            className="rounded-md border border-stone p-1.5 text-graphite transition-colors hover:bg-mist hover:text-body dark:border-ink-body dark:hover:bg-night-700"
            title="Mes anterior"
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
            onClick={() => setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="rounded-md border border-stone p-1.5 text-graphite transition-colors hover:bg-mist hover:text-body dark:border-ink-body dark:hover:bg-night-700"
            title="Mes siguiente"
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

      {/* Day-of-week header */}
      <div className="mb-1 grid grid-cols-7 gap-1 text-[10px] font-semibold uppercase tracking-wider text-graphite">
        {DAY_LABELS.map(d => (
          <div key={d} className="px-1 py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          const iso = formatISODate(d)
          const items = byDay.get(iso) ?? []
          const isToday = iso === todayISO
          const isCurMonth = d.getMonth() === currentMonth
          const isWeekend = i % 7 >= 5
          const visible = items.slice(0, MAX_VISIBLE_PER_CELL)
          const hidden = Math.max(0, items.length - MAX_VISIBLE_PER_CELL)
          return (
            <div
              key={iso}
              className={`flex min-h-[88px] flex-col rounded-lg border p-1.5 transition-colors ${
                isToday
                  ? 'border-signal bg-signal-wash/30 ring-1 ring-signal dark:bg-signal/20'
                  : isCurMonth
                    ? isWeekend
                      ? 'border-stone-100 bg-mist/40 dark:border-night-700 dark:bg-night/50'
                      : 'border-stone bg-white dark:border-ink-body dark:bg-night'
                    : 'border-stone-100 bg-mist/30 opacity-60 dark:border-night-700 dark:bg-night/30'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${isToday ? 'text-signal-ink' : isCurMonth ? 'text-ink-body dark:text-stone' : 'text-graphite'}`}>
                  {d.getDate()}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-0.5">
                {isLoading && i < 7 && (
                  <div className="h-3 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
                )}
                {visible.map(t => (
                  <Link
                    key={t.id}
                    href={`/dashboard/tasks?taskId=${t.id}`}
                    className={`block truncate rounded px-1 py-0.5 text-[10px] font-medium text-white transition-opacity hover:opacity-90 ${t.status === 'done' ? 'line-through opacity-60' : ''}`}
                    style={{ backgroundColor: t.project?.color ?? '#94a3b8' }}
                    title={t.title}
                  >
                    {t.title}
                  </Link>
                ))}
                {hidden > 0 && (
                  <button
                    onClick={() => setExpandedDay(iso)}
                    className="flex items-center gap-0.5 text-[10px] text-graphite hover:text-graphite dark:hover:text-stone"
                  >
                    <MoreHorizontal className="h-2.5 w-2.5" /> +{hidden}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Overflow flyout for a day */}
      {expandedDay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
          onClick={() => setExpandedDay(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-night dark:text-stone-100">
              {new Date(expandedDay).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {(byDay.get(expandedDay) ?? []).map(t => (
                <li key={t.id}>
                  <Link
                    href={`/dashboard/tasks?taskId=${t.id}`}
                    className="flex items-start gap-2 rounded-lg border border-stone-100 px-2.5 py-2 text-xs transition-colors hover:bg-mist dark:border-ink-body dark:hover:bg-night-700"
                    onClick={() => setExpandedDay(null)}
                  >
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.project?.color ?? '#94a3b8' }} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium text-night dark:text-stone-100 ${t.status === 'done' ? 'line-through opacity-60' : ''}`}>
                        {t.title}
                      </p>
                      {t.project && (
                        <p className="text-[10px] text-graphite">{t.project.code} · {t.project.name}</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
