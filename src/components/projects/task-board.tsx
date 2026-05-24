'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AddTaskDialog } from './add-task-dialog'
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Calendar, AlertCircle } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'Por hacer' },
  { id: 'in_progress', label: 'En progreso' },
  { id: 'in_review', label: 'En revisión' },
  { id: 'done', label: 'Listo' },
  { id: 'canceled', label: 'Cancelado' },
]

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo: 'bg-slate-200',
  in_progress: 'bg-blue-400',
  in_review: 'bg-yellow-400',
  done: 'bg-green-400',
  canceled: 'bg-red-300',
}

interface Props { projectId: string }

export function TaskBoard({ projectId }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState<TaskStatus>('todo')
  const { data: tasks, isLoading, error } = trpc.tasks.byProject.useQuery(projectId)
  const utils = trpc.useUtils()

  const updateTask = trpc.tasks.update.useMutation({
    onMutate: async (input) => {
      await utils.tasks.byProject.cancel(projectId)
      const prev = utils.tasks.byProject.getData(projectId)
      utils.tasks.byProject.setData(projectId, (old) =>
        old?.map(t => t.id === input.id ? { ...t, ...input } : t) ?? []
      )
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.tasks.byProject.setData(projectId, ctx.prev)
    },
    onSettled: () => utils.tasks.byProject.invalidate(projectId),
  })

  function openAdd(status: TaskStatus) {
    setAddStatus(status)
    setAddOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col, ci) => (
          <div key={col.id} className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
              <div className={`h-1.5 w-1.5 rounded-full ${COLUMN_ACCENT[col.id]}`} />
              <div className="h-3 w-20 rounded bg-slate-200 animate-pulse" />
            </div>
            <div className="flex flex-col gap-2 p-2">
              {[...Array(ci === 0 ? 3 : ci === 1 ? 2 : 1)].map((_, i) => (
                <div key={i} className="rounded-lg bg-white border border-slate-100 p-3 space-y-2.5">
                  <div className="h-3.5 w-full rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-slate-100 animate-pulse" />
                  <div className="flex justify-between">
                    <div className="h-2.5 w-12 rounded bg-slate-100 animate-pulse" />
                    <div className="h-5 w-5 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <AlertCircle className="mb-2 h-6 w-6" />
        <p className="text-sm">Error al cargar el tablero</p>
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map(col => {
        const colTasks = tasks?.filter(t => t.status === col.id) ?? []

        return (
          <div key={col.id} className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50">
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className={`h-1.5 w-1.5 rounded-full ${COLUMN_ACCENT[col.id]}`} />
                <span className="text-xs font-semibold text-slate-700">{col.label}</span>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                  {colTasks.length}
                </span>
              </div>
              <button
                onClick={() => openAdd(col.id)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                title="Agregar tarea"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 flex-1">
              {colTasks.length === 0 ? (
                <button
                  onClick={() => openAdd(col.id)}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-6 text-slate-400 hover:border-slate-300 hover:bg-white hover:text-slate-500 transition-all"
                >
                  <Plus className="h-4 w-4" />
                  <span className="text-[11px]">Agregar tarea</span>
                </button>
              ) : (
                colTasks.map(task => {
                  const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
                  const days = task.due_date ? daysUntil(task.due_date) : null
                  const isOverdue = days !== null && days < 0 && task.status !== 'done' && task.status !== 'canceled'

                  return (
                    <div
                      key={task.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-default group"
                    >
                      <p className="text-sm font-medium text-slate-800 leading-snug">{task.title}</p>

                      <div className="mt-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className={`h-2 w-2 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`} />
                          <span className={`text-[11px] font-medium ${priorityInfo?.color ?? 'text-slate-500'}`}>
                            {priorityInfo?.label}
                          </span>
                        </div>

                        {task.assignee && (
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                            <AvatarFallback className="text-[9px]">
                              {task.assignee.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>

                      {task.due_date && (
                        <div className={`mt-2 flex items-center gap-1 text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                          <Calendar className="h-3 w-3" />
                          {isOverdue ? `Vencida ${Math.abs(days!)}d` : formatDate(task.due_date)}
                        </div>
                      )}

                      {/* Quick move buttons — show on hover */}
                      <div className="mt-2 hidden gap-1 flex-wrap group-hover:flex">
                        {COLUMNS.filter(c => c.id !== task.status).slice(0, 2).map(c => (
                          <button
                            key={c.id}
                            onClick={() => updateTask.mutate({ id: task.id, status: c.id })}
                            disabled={updateTask.isPending}
                            className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-700 transition-colors disabled:opacity-50"
                          >
                            → {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}

              {colTasks.length > 0 && (
                <button
                  onClick={() => openAdd(col.id)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar tarea
                </button>
              )}
            </div>
          </div>
        )
      })}

      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} defaultStatus={addStatus} />
    </div>
  )
}
