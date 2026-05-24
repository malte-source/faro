'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { ArrowRight, Calendar, CheckSquare } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const TASK_STATUS_VARIANT: Record<TaskStatus, 'secondary' | 'default' | 'warning' | 'success' | 'danger'> = {
  todo: 'secondary', in_progress: 'default', in_review: 'warning', done: 'success', canceled: 'danger',
}
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Por hacer', in_progress: 'En progreso', in_review: 'En revisión', done: 'Listo', canceled: 'Cancelado',
}

export function MyTasksWidget() {
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({ onlyMine: true })
  const utils = trpc.useUtils()

  const update = trpc.tasks.update.useMutation({
    // Optimistic update: instantly reflect the status change
    onMutate: async (input) => {
      await utils.tasks.list.cancel({ onlyMine: true })
      const prev = utils.tasks.list.getData({ onlyMine: true })
      utils.tasks.list.setData({ onlyMine: true }, (old) =>
        old?.map(t => t.id === input.id
          ? { ...t, ...(input.status && { status: input.status }) }
          : t
        ) ?? []
      )
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.tasks.list.setData({ onlyMine: true }, ctx.prev)
    },
    onSettled: () => utils.tasks.list.invalidate({ onlyMine: true }),
  })

  const pending = tasks?.filter(t => t.status !== 'done' && t.status !== 'canceled') ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-indigo-600" />
          Mis tareas
        </CardTitle>
        <Link href="/dashboard/tasks?view=mine" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
          Ver todas <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="divide-y divide-slate-50">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-3 px-6 py-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-24 rounded-md shrink-0" />
              </div>
            ))}
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <CheckSquare className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-emerald-600">¡Todo al día!</p>
            <p className="text-xs mt-0.5 text-slate-400">No tenés tareas pendientes</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {pending.slice(0, 6).map(task => {
              const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
              const days = task.due_date ? daysUntil(task.due_date) : null
              const isOverdue = days !== null && days < 0
              const project = task.project as { id: string; code: string; name: string; color: string } | null

              return (
                <div key={task.id} className="flex items-center gap-3 px-6 py-2.5 hover:bg-slate-50 transition-colors">
                  <div className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">{task.title}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {project && (
                        <Link href={`/dashboard/projects/${project.id}`} className="flex items-center gap-1 hover:opacity-70 transition-opacity">
                          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                          <span className="text-[11px] text-slate-400">{project.code}</span>
                        </Link>
                      )}
                      {task.due_date && (
                        <span className={`flex items-center gap-0.5 text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                          <Calendar className="h-3 w-3" />
                          {isOverdue ? `${Math.abs(days!)}d vencida` : formatDate(task.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Select
                      value={task.status}
                      onValueChange={val => update.mutate({ id: task.id, status: val as TaskStatus })}
                    >
                      <SelectTrigger className="h-6 w-28 text-[11px] px-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TASK_STATUS_LABEL).map(([v, l]) => (
                          <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )
            })}
            {pending.length > 6 && (
              <Link
                href="/dashboard/tasks?view=mine"
                className="flex items-center justify-center gap-1 px-6 py-2.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                +{pending.length - 6} tareas más <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
