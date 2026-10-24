'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { ChevronLeft, ChevronRight, Calendar, CheckSquare, FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { haptic } from '@/components/mobile/haptics'

/* ── helpers ──────────────────────────────────────────────────────── */

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1)
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

/** Local YYYY-MM-DD (toISOString would shift the day for users east of UTC). */
function toDateKey(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const TASK_STATUS_DOT: Record<string, string> = {
  todo:        'bg-graphite',
  in_progress: 'bg-info',
  in_review:   'bg-yellow-500',
  done:        'bg-success',
  canceled:    'bg-danger',
}

/* ── main component ──────────────────────────────────────────────── */

export function CalendarView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  // Data
  const { data: tasks } = trpc.tasks.list.useQuery({})
  const { data: projects } = trpc.projects.list.useQuery()

  /* Build event maps */
  const tasksByDay = useMemo(() => {
    const map: Record<string, typeof tasks> = {}
    for (const task of tasks ?? []) {
      if (!task.due_date) continue
      const key = task.due_date.split('T')[0]
      if (!map[key]) map[key] = []
      map[key]!.push(task)
    }
    return map
  }, [tasks])

  const projectsByDay = useMemo(() => {
    const map: Record<string, typeof projects> = {}
    for (const p of projects ?? []) {
      if (!p.end_date || p.status === 'canceled' || p.status === 'completed') continue
      const key = p.end_date.split('T')[0]
      if (!map[key]) map[key] = []
      map[key]!.push(p)
    }
    return map
  }, [projects])

  /* Calendar grid */
  const firstDay = startOfMonth(year, month)
  const totalDays = daysInMonth(year, month)
  // Monday-first: getDay() returns 0=Sun, convert to Mon=0
  const startOffset = (firstDay.getDay() + 6) % 7

  const cells: Array<Date | null> = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(year, month, i + 1)),
  ]
  // Pad to complete last week
  while (cells.length % 7 !== 0) cells.push(null)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
    setSelectedDay(null)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
    setSelectedDay(null)
  }
  function goToday() {
    setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDay(null)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })
  const todayKey = toDateKey(today)

  const selectedTasks = selectedDay ? (tasksByDay[selectedDay] ?? []) : []
  const selectedProjects = selectedDay ? (projectsByDay[selectedDay] ?? []) : []

  /* Phone: the agenda always shows a day (today, or the 1st when browsing another month). */
  const inCurrentMonth = year === today.getFullYear() && month === today.getMonth()
  const mobileDay = selectedDay ?? (inCurrentMonth ? todayKey : toDateKey(new Date(year, month, 1)))
  const mobileTasks = tasksByDay[mobileDay] ?? []
  const mobileProjects = projectsByDay[mobileDay] ?? []
  const mobileDayLabel = new Date(mobileDay + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })

  const onTouchStart = (e: React.TouchEvent) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const dx = e.changedTouches[0].clientX - s.x
    const dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      haptic()
      if (dx < 0) nextMonth(); else prevMonth()
    }
  }

  return (
    <>
      {/* ═════════════ Phone — iOS Calendar pattern ═════════════ */}
      <div className="flex-1 overflow-y-auto pb-6 md:hidden">
        <div className="px-4">
          <div className="flex items-center justify-between py-1">
            <h2 className="font-display text-[22px] font-extrabold capitalize tracking-[-0.035em] text-foreground">{monthLabel}</h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { haptic(); prevMonth() }} aria-label="Mes anterior" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => { haptic(); goToday() }}
                disabled={inCurrentMonth && !selectedDay}
                className="h-8 rounded-full bg-border-soft px-3 text-[13px] font-semibold text-foreground active:bg-border disabled:opacity-40"
              >
                Hoy
              </button>
              <button type="button" onClick={() => { haptic(); nextMonth() }} aria-label="Mes siguiente" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-1 grid grid-cols-7 text-center" aria-hidden>
            {WEEKDAY_LETTERS.map(d => (
              <span key={d} className="py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 touch-pan-y" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-no-ptr>
            {cells.map((date, i) => {
              if (!date) return <span key={i} className="h-[52px]" />
              const key = toDateKey(date)
              const dayTasks = tasksByDay[key] ?? []
              const dayProjects = projectsByDay[key] ?? []
              const isToday = key === todayKey
              const isSelected = key === mobileDay
              const dots = [
                ...dayTasks.slice(0, 3).map(t => ({ id: t.id, cls: TASK_STATUS_DOT[t.status] ?? 'bg-graphite', color: undefined as string | undefined })),
                ...dayProjects.slice(0, 1).map(p => ({ id: p.id, cls: '', color: p.color as string | undefined })),
              ].slice(0, 3)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { haptic(); setSelectedDay(key) }}
                  aria-label={`${date.getDate()} de ${date.toLocaleDateString('es', { month: 'long' })}${dayTasks.length ? `, ${dayTasks.length} tareas` : ''}`}
                  aria-pressed={isSelected}
                  className="flex h-[52px] flex-col items-center justify-start gap-0.5 pt-1"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-medium tabular-nums transition-colors',
                      isToday && isSelected && 'bg-signal font-bold text-night',
                      isToday && !isSelected && 'bg-signal/25 font-bold text-foreground',
                      !isToday && isSelected && 'bg-night font-semibold text-mist dark:bg-foreground dark:text-night',
                      !isToday && !isSelected && 'text-foreground',
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <span className="flex h-1.5 items-center gap-[3px]">
                    {dots.map(d => (
                      <span key={d.id} className={cn('h-1.5 w-1.5 rounded-full', d.cls)} style={d.color ? { backgroundColor: d.color } : undefined} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Agenda for the chosen day */}
        <div className="mt-4 space-y-4 px-4">
          <p className="px-1 font-display text-[17px] font-extrabold capitalize tracking-[-0.03em] text-foreground">{mobileDayLabel}</p>
          {mobileTasks.length === 0 && mobileProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border py-10 text-graphite">
              <Calendar className="mb-2 h-6 w-6" />
              <p className="text-sm">Sin eventos este día</p>
            </div>
          ) : (
            <>
              {mobileTasks.length > 0 && (
                <InsetGroup label={`Tareas · ${mobileTasks.length}`}>
                  {mobileTasks.map(t => {
                    const project = t.project as { id: string; code: string; color: string } | null
                    return (
                      <ListRow
                        key={t.id}
                        href={project ? `/dashboard/projects/${project.id}` : '/dashboard/tasks'}
                        leading={<span className={cn('h-2.5 w-2.5 rounded-full', TASK_STATUS_DOT[t.status] ?? 'bg-graphite')} />}
                        title={t.title}
                        subtitle={project?.code}
                      />
                    )
                  })}
                </InsetGroup>
              )}
              {mobileProjects.length > 0 && (
                <InsetGroup label={`Proyectos · ${mobileProjects.length}`}>
                  {mobileProjects.map(p => (
                    <ListRow
                      key={p.id}
                      href={`/dashboard/projects/${p.id}`}
                      leading={<span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />}
                      title={p.name}
                      subtitle={`Vencimiento · ${p.code}`}
                    />
                  ))}
                </InsetGroup>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═════════════ Desktop ═════════════ */}
      <div className="hidden flex-1 flex-col gap-4 overflow-auto px-6 py-5 md:flex">
        {/* Nav row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={prevMonth}
              className="rounded-lg border border-border p-2 text-graphite hover:bg-border-soft transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-base font-semibold capitalize text-foreground min-w-[180px] text-center">
              {monthLabel}
            </h2>
            <button
              onClick={nextMonth}
              className="rounded-lg border border-border p-2 text-graphite hover:bg-border-soft transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={goToday}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-graphite hover:bg-border-soft transition-colors"
          >
            Hoy
          </button>
        </div>

        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Calendar grid */}
          <div className="flex-1 rounded-xl border border-border bg-surface overflow-hidden">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-border-soft">
              {WEEKDAYS.map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-graphite">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {cells.map((date, i) => {
                if (!date) {
                  return <div key={i} className="min-h-[80px] border-b border-r border-border-soft bg-background/50" />
                }

                const key = toDateKey(date)
                const dayTasks = tasksByDay[key] ?? []
                const dayProjects = projectsByDay[key] ?? []
                const isToday = key === todayKey
                const isSelected = key === selectedDay
                const isLastRow = i >= cells.length - 7

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(isSelected ? null : key)}
                    className={cn(
                      'min-h-[80px] w-full p-1.5 text-left border-b border-r border-border-soft transition-colors',
                      isSelected ? 'bg-signal-wash dark:bg-signal/10' : 'hover:bg-background',
                      isLastRow && 'border-b-0',
                      i % 7 === 6 && 'border-r-0'
                    )}
                  >
                    {/* Day number */}
                    <div className={cn(
                      'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                      isToday ? 'bg-signal font-bold text-night' : 'text-graphite'
                    )}>
                      {date.getDate()}
                    </div>

                    {/* Task chips */}
                    <div className="space-y-0.5">
                      {dayTasks.slice(0, 2).map(t => (
                        <div
                          key={t.id}
                          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] bg-info/10 text-info truncate"
                        >
                          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT[t.status] ?? 'bg-graphite'}`} />
                          <span className="truncate">{t.title}</span>
                        </div>
                      ))}
                      {dayProjects.slice(0, 1).map(p => (
                        <div
                          key={p.id}
                          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] truncate"
                          style={{ backgroundColor: `${p.color}18`, color: p.color }}
                        >
                          <FolderKanban className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{p.code}</span>
                        </div>
                      ))}
                      {(dayTasks.length + dayProjects.length) > 3 && (
                        <div className="text-[10px] text-graphite pl-1">
                          +{dayTasks.length + dayProjects.length - 3} más
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Day detail sidebar */}
          {selectedDay && (
            <div className="w-full lg:w-72 shrink-0 rounded-xl border border-border bg-surface overflow-hidden">
              <div className="border-b border-border-soft px-4 py-3">
                <p className="text-sm font-semibold text-foreground">
                  {new Date(selectedDay + 'T12:00:00').toLocaleDateString('es', {
                    weekday: 'long', day: 'numeric', month: 'long'
                  })}
                </p>
              </div>

              <div className="max-h-[500px] overflow-y-auto">
                {selectedTasks.length === 0 && selectedProjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-graphite">
                    <Calendar className="mb-2 h-6 w-6" />
                    <p className="text-sm">Sin eventos este día</p>
                  </div>
                ) : (
                  <div className="p-3 space-y-4">
                    {/* Tasks */}
                    {selectedTasks.length > 0 && (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-graphite">
                          <CheckSquare className="h-3 w-3" /> Tareas ({selectedTasks.length})
                        </p>
                        <div className="space-y-1.5">
                          {selectedTasks.map(t => {
                            const project = t.project as { id: string; code: string; color: string } | null
                            return (
                              <div key={t.id} className="flex items-start gap-2 rounded-lg bg-background px-3 py-2">
                                <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TASK_STATUS_DOT[t.status] ?? 'bg-graphite'}`} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-foreground leading-snug">{t.title}</p>
                                  {project && (
                                    <Link
                                      href={`/dashboard/projects/${project.id}`}
                                      className="flex items-center gap-1 mt-0.5 hover:opacity-70 transition-opacity"
                                    >
                                      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                                      <span className="text-[10px] text-graphite">{project.code}</span>
                                    </Link>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Projects */}
                    {selectedProjects.length > 0 && (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-graphite">
                          <FolderKanban className="h-3 w-3" /> Proyectos ({selectedProjects.length})
                        </p>
                        <div className="space-y-1.5">
                          {selectedProjects.map(p => (
                            <Link
                              key={p.id}
                              href={`/dashboard/projects/${p.id}`}
                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-background transition-colors"
                            >
                              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-body truncate">{p.name}</p>
                                <p className="text-[10px] text-graphite">Vencimiento — {p.code}</p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
