'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'

/**
 * Gantt chart of all projects in the org — read-only timeline visualization.
 *
 * Layout:
 *   - Left fixed column (224 px): project name + code
 *   - Right area: horizontally scrollable timeline, 1 row per project
 *   - Bars positioned by start_date → end_date, fill shows progress_pct
 *   - "Today" marker = vertical cyan line
 *   - Header shows months across the visible range
 *
 * Implementation note: pure SVG/HTML, no Gantt library dependency.
 * Day width is adjustable (zoom buttons) to let users widen narrow projects.
 */

const DAY_MS = 86_400_000

function toDate(s: string | null): Date | null {
  return s ? new Date(s + 'T00:00:00') : null
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

function fmtMonth(d: Date): string {
  return d.toLocaleString('es', { month: 'short', year: '2-digit' })
}

export function ProjectGantt() {
  const { data: projects, isLoading } = trpc.projects.list.useQuery()
  const [dayWidth, setDayWidth] = useState(14) // px per day

  const dated = useMemo(() => {
    if (!projects) return []
    return projects
      .filter(p => p.start_date && p.end_date)
      .map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        color: p.color,
        status: p.status,
        progress_pct: p.progress_pct,
        start: toDate(p.start_date)!,
        end: toDate(p.end_date)!,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [projects])

  // Compute timeline bounds: min start, max end, expanded by 1 week each side.
  const bounds = useMemo(() => {
    if (!dated.length) return null
    const minStart = new Date(Math.min(...dated.map(d => d.start.getTime())))
    const maxEnd = new Date(Math.max(...dated.map(d => d.end.getTime())))
    const start = new Date(minStart.getTime() - 7 * DAY_MS)
    const end = new Date(maxEnd.getTime() + 7 * DAY_MS)
    return { start, end, totalDays: daysBetween(start, end) }
  }, [dated])

  // Month label positions across the timeline header.
  const months = useMemo(() => {
    if (!bounds) return []
    const out: { date: Date; offset: number }[] = []
    const cursor = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), 1)
    while (cursor < bounds.end) {
      out.push({ date: new Date(cursor), offset: daysBetween(bounds.start, cursor) * dayWidth })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return out
  }, [bounds, dayWidth])

  const todayOffset = useMemo(() => {
    if (!bounds) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (today < bounds.start || today > bounds.end) return null
    return daysBetween(bounds.start, today) * dayWidth
  }, [bounds, dayWidth])

  if (isLoading) {
    return (
      <div className="rounded-xl border border-stone bg-white p-6 dark:border-night-700 dark:bg-night">
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      </div>
    )
  }

  if (!dated.length) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-12 text-center dark:border-ink-body dark:bg-night">
        <p className="text-sm text-graphite">
          No hay proyectos con fechas de inicio y fin definidas.
        </p>
        <p className="mt-1 text-xs text-graphite">
          Edita un proyecto y define <strong>Fecha inicio</strong> y <strong>Fecha fin</strong> para verlo en el Gantt.
        </p>
      </div>
    )
  }

  const timelineWidth = bounds!.totalDays * dayWidth
  const rowHeight = 44

  return (
    <div className="rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-2 dark:border-night-700">
        <p className="text-xs text-graphite">
          {dated.length} proyectos · {bounds!.totalDays} días
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-stone dark:border-ink-body">
          <button
            onClick={() => setDayWidth(w => Math.max(4, w - 2))}
            className="px-3.5 py-2 text-sm md:px-2.5 md:py-1 md:text-xs text-graphite hover:bg-mist dark:text-stone dark:hover:bg-night-700"
            title="Comprimir"
          >−</button>
          <span className="border-x border-stone px-2 py-1 text-[10px] tabular-nums text-graphite dark:border-ink-body">
            {dayWidth}px/día
          </span>
          <button
            onClick={() => setDayWidth(w => Math.min(40, w + 2))}
            className="px-3.5 py-2 text-sm md:px-2.5 md:py-1 md:text-xs text-graphite hover:bg-mist dark:text-stone dark:hover:bg-night-700"
            title="Expandir"
          >+</button>
        </div>
      </div>

      <div className="flex overflow-hidden">
        {/* Left: project labels (sticky) */}
        <div className="w-32 shrink-0 border-r border-border-soft md:w-56 dark:border-night-700">
          {/* spacer to match header height */}
          <div className="h-9 border-b border-stone-100 dark:border-night-700" />
          {dated.map(p => (
            <Link
              key={p.id}
              href={`/dashboard/projects/${p.id}`}
              className="flex items-center gap-2 border-b border-border-soft px-2 active:bg-border-soft md:px-3 md:hover:bg-background dark:border-night-700 dark:hover:bg-night-700"
              style={{ height: rowHeight }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-night dark:text-stone-100">
                  {p.name}
                </p>
                <p className="text-[10px] text-graphite">{p.code}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Right: timeline (scrollable) */}
        <div className="flex-1 overflow-x-auto" data-no-track data-no-ptr>
          <div className="relative" style={{ width: timelineWidth, minWidth: '100%' }}>
            {/* Month header */}
            <div className="sticky top-0 h-9 border-b border-stone-100 bg-white dark:border-night-700 dark:bg-night">
              {months.map((m, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex h-full items-center border-l border-stone-100 pl-2 text-[10px] uppercase tracking-wider text-graphite dark:border-night-700"
                  style={{ left: m.offset }}
                >
                  {fmtMonth(m.date)}
                </div>
              ))}
            </div>

            {/* Today line */}
            {todayOffset !== null && (
              <div
                className="pointer-events-none absolute top-0 z-10 h-full w-px bg-signal"
                style={{ left: todayOffset, height: rowHeight * dated.length + 36 }}
              >
                <div className="absolute -top-px -translate-x-1/2 rounded-sm bg-signal px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                  Hoy
                </div>
              </div>
            )}

            {/* Rows + bars */}
            {dated.map(p => {
              const offset = daysBetween(bounds!.start, p.start) * dayWidth
              const width = Math.max(daysBetween(p.start, p.end) + 1, 1) * dayWidth
              const isDone = p.status === 'completed'
              const isLate = p.status === 'delayed'
              return (
                <div
                  key={p.id}
                  className="relative border-b border-mist dark:border-night-700"
                  style={{ height: rowHeight }}
                >
                  {/* Bar */}
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className={cn(
                      'group absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md shadow-sm transition-all hover:shadow-md',
                      isLate && 'ring-2 ring-danger',
                    )}
                    style={{
                      left: offset,
                      width,
                      height: 24,
                      backgroundColor: `${p.color}33`,
                      borderLeft: `3px solid ${p.color}`,
                    }}
                    title={`${p.name} · ${p.start.toLocaleDateString('es')} → ${p.end.toLocaleDateString('es')} · ${p.progress_pct}%`}
                  >
                    {/* Progress fill */}
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        backgroundColor: p.color,
                        width: `${Math.max(0, Math.min(100, p.progress_pct))}%`,
                        opacity: isDone ? 0.85 : 0.7,
                      }}
                    />
                    <span className="relative z-10 truncate px-2 text-[11px] font-medium text-foreground mix-blend-luminosity">
                      {p.progress_pct}%
                    </span>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
