'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { ChevronLeft, ChevronRight, Calendar, CheckSquare, FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── helpers ──────────────────────────────────────────────────────── */

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1)
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function toDateKey(d: Date) {
  return d.toISOString().split('T')[0]
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const TASK_STATUS_DOT: Record<string, string> = {
  todo:        'bg-slate-400',
  in_progress: 'bg-blue-500',
  in_review:   'bg-yellow-500',
  done:        'bg-emerald-500',
  canceled:    'bg-red-400',
}

/* ── main component ──────────────────────────────────────────────── */

export function CalendarView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

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
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })
  const todayKey = toDateKey(today)

  const selectedTasks = selectedDay ? (tasksByDay[selectedDay] ?? []) : []
  const selectedProjects = selectedDay ? (projectsByDay[selectedDay] ?? []) : []

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-5 md:px-6">
      {/* Nav row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-semibold capitalize text-slate-800 min-w-[180px] text-center">
            {monthLabel}
          </h2>
          <button
            onClick={nextMonth}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Hoy
        </button>
      </div>

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Calendar grid */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-white overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {WEEKDAYS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              if (!date) {
                return <div key={i} className="min-h-[80px] border-b border-r border-slate-50 bg-slate-50/50" />
              }

              const key = toDateKey(date)
              const dayTasks = tasksByDay[key] ?? []
              const dayProjects = projectsByDay[key] ?? []
              const isToday = key === todayKey
              const isSelected = key === selectedDay
              const hasEvents = dayTasks.length > 0 || dayProjects.length > 0
              const isLastRow = i >= cells.length - 7

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  className={cn(
                    'min-h-[80px] w-full p-1.5 text-left border-b border-r border-slate-100 transition-colors',
                    isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50',
                    isLastRow && 'border-b-0',
                    i % 7 === 6 && 'border-r-0'
                  )}
                >
                  {/* Day number */}
                  <div className={cn(
                    'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                    isToday ? 'bg-indigo-600 text-white' : 'text-slate-600'
                  )}>
                    {date.getDate()}
                  </div>

                  {/* Task chips */}
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 2).map(t => (
                      <div
                        key={t.id}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] bg-blue-50 text-blue-700 truncate"
                      >
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT[t.status] ?? 'bg-slate-400'}`} />
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
                      <div className="text-[10px] text-slate-400 pl-1">
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
          <div className="w-full lg:w-72 shrink-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('es', {
                  weekday: 'long', day: 'numeric', month: 'long'
                })}
              </p>
            </div>

            <div className="max-h-[500px] overflow-y-auto">
              {selectedTasks.length === 0 && selectedProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <Calendar className="mb-2 h-6 w-6" />
                  <p className="text-sm">Sin eventos este día</p>
                </div>
              ) : (
                <div className="p-3 space-y-4">
                  {/* Tasks */}
                  {selectedTasks.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <CheckSquare className="h-3 w-3" /> Tareas ({selectedTasks.length})
                      </p>
                      <div className="space-y-1.5">
                        {selectedTasks.map(t => {
                          const project = t.project as { id: string; code: string; color: string } | null
                          return (
                            <div key={t.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
                              <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TASK_STATUS_DOT[t.status] ?? 'bg-slate-400'}`} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-800 leading-snug">{t.title}</p>
                                {project && (
                                  <Link
                                    href={`/dashboard/projects/${project.id}`}
                                    className="flex items-center gap-1 mt-0.5 hover:opacity-70 transition-opacity"
                                  >
                                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                                    <span className="text-[10px] text-slate-400">{project.code}</span>
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
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <FolderKanban className="h-3 w-3" /> Proyectos ({selectedProjects.length})
                      </p>
                      <div className="space-y-1.5">
                        {selectedProjects.map(p => (
                          <Link
                            key={p.id}
                            href={`/dashboard/projects/${p.id}`}
                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
                          >
                            <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-700 truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-400">Vencimiento — {p.code}</p>
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
  )
}
