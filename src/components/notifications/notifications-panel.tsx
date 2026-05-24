'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Bell, AlertCircle, Clock, Calendar, X, ChevronRight } from 'lucide-react'
import { formatDate, daysUntil } from '@/lib/utils'

export function NotificationsPanel() {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every minute
    staleTime: 30_000,
  })

  const totalCount = data?.totalCount ?? 0

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        title="Notificaciones"
      >
        <Bell className="h-4 w-4" />
        {totalCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute bottom-full left-0 z-50 mb-2 w-80 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-800">Notificaciones</span>
                {totalCount > 0 && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                    {totalCount}
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
                  Cargando...
                </div>
              )}

              {!isLoading && totalCount === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-10">
                  <Bell className="h-8 w-8 text-slate-200" />
                  <p className="text-sm font-medium text-green-600">¡Todo al día!</p>
                  <p className="text-xs text-slate-400">No tenés notificaciones pendientes</p>
                </div>
              )}

              {/* Overdue tasks */}
              {(data?.overdueTasks.length ?? 0) > 0 && (
                <div>
                  <div className="flex items-center gap-2 bg-red-50 px-4 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-semibold text-red-700">
                      Vencidas ({data!.overdueTasks.length})
                    </span>
                  </div>
                  {data!.overdueTasks.map(task => {
                    const days = task.due_date ? daysUntil(task.due_date) : null
                    return (
                      <Link
                        key={task.id}
                        href={task.project ? `/dashboard/projects/${task.project.id}` : '/dashboard/tasks'}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: task.project?.color ?? '#94a3b8' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                          <p className="mt-0.5 text-[11px] font-medium text-red-500">
                            {days !== null ? `Venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? 's' : ''}` : 'Vencida'}
                            {task.project && <span className="ml-1.5 font-normal text-slate-400">· {task.project.code}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                      </Link>
                    )
                  })}
                </div>
              )}

              {/* Due soon tasks */}
              {(data?.dueSoonTasks.length ?? 0) > 0 && (
                <div className={(data?.overdueTasks.length ?? 0) > 0 ? 'border-t border-slate-100' : ''}>
                  <div className="flex items-center gap-2 bg-orange-50 px-4 py-2">
                    <Clock className="h-3.5 w-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-orange-700">
                      Próximas 3 días ({data!.dueSoonTasks.length})
                    </span>
                  </div>
                  {data!.dueSoonTasks.map(task => {
                    const days = task.due_date ? daysUntil(task.due_date) : null
                    return (
                      <Link
                        key={task.id}
                        href={task.project ? `/dashboard/projects/${task.project.id}` : '/dashboard/tasks'}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: task.project?.color ?? '#94a3b8' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                          <p className="mt-0.5 text-[11px] text-orange-600">
                            {days === 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
                            {task.project && <span className="ml-1.5 text-slate-400">· {task.project.code}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                      </Link>
                    )
                  })}
                </div>
              )}

              {/* Due projects */}
              {(data?.dueProjects.length ?? 0) > 0 && (
                <div className={((data?.overdueTasks.length ?? 0) + (data?.dueSoonTasks.length ?? 0)) > 0 ? 'border-t border-slate-100' : ''}>
                  <div className="flex items-center gap-2 bg-blue-50 px-4 py-2">
                    <Calendar className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-xs font-semibold text-blue-700">
                      Proyectos — próximos 7 días ({data!.dueProjects.length})
                    </span>
                  </div>
                  {data!.dueProjects.map(project => {
                    const days = project.end_date ? daysUntil(project.end_date) : null
                    return (
                      <Link
                        key={project.id}
                        href={`/dashboard/projects/${project.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800">
                            <span className="mr-1 text-slate-400">{project.code}</span>
                            {project.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-blue-600">
                            {days === 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
                            {project.end_date && <span className="ml-1.5 text-slate-400">· {formatDate(project.end_date)}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {totalCount > 0 && (
              <div className="border-t border-slate-100 px-4 py-2.5">
                <Link
                  href="/dashboard/tasks?view=mine"
                  onClick={() => setOpen(false)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  Ver todas mis tareas →
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
