'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AddTaskDialog } from './add-task-dialog'
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Calendar } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'todo', label: 'Por hacer', color: 'bg-slate-100' },
  { id: 'in_progress', label: 'En progreso', color: 'bg-blue-50' },
  { id: 'in_review', label: 'En revisión', color: 'bg-yellow-50' },
  { id: 'done', label: 'Listo', color: 'bg-green-50' },
  { id: 'canceled', label: 'Cancelado', color: 'bg-red-50' },
]

interface Props { projectId: string }

export function TaskBoard({ projectId }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState<TaskStatus>('todo')
  const { data: tasks } = trpc.tasks.byProject.useQuery(projectId)
  const utils = trpc.useUtils()

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.byProject.invalidate(projectId),
  })

  function openAdd(status: TaskStatus) {
    setAddStatus(status)
    setAddOpen(true)
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map(col => {
        const colTasks = tasks?.filter(t => t.status === col.id) ?? []

        return (
          <div key={col.id} className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">{col.label}</span>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {colTasks.length}
                </span>
              </div>
              <button
                onClick={() => openAdd(col.id)}
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 p-2 flex-1">
              {colTasks.map(task => {
                const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
                const days = task.due_date ? daysUntil(task.due_date) : null
                const isOverdue = days !== null && days < 0 && task.status !== 'done' && task.status !== 'canceled'

                return (
                  <div
                    key={task.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow cursor-default"
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

                    <div className="mt-2 flex gap-1 flex-wrap">
                      {COLUMNS.filter(c => c.id !== task.status).slice(0, 2).map(c => (
                        <button
                          key={c.id}
                          onClick={() => updateTask.mutate({ id: task.id, status: c.id })}
                          className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                        >
                          → {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              <button
                onClick={() => openAdd(col.id)}
                className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Agregar tarea
              </button>
            </div>
          </div>
        )
      })}

      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} defaultStatus={addStatus} />
    </div>
  )
}
