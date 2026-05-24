'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AddTaskDialog } from './add-task-dialog'
import { EditTaskDialog } from './edit-task-dialog'
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Trash2, Calendar, AlertCircle, Pencil } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const TASK_STATUS = {
  todo: { label: 'Por hacer', variant: 'secondary' as const },
  in_progress: { label: 'En progreso', variant: 'default' as const },
  in_review: { label: 'En revisión', variant: 'warning' as const },
  done: { label: 'Listo', variant: 'success' as const },
  canceled: { label: 'Cancelado', variant: 'danger' as const },
}

interface Props { projectId: string }

export function TaskList({ projectId }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTaskId, setEditTaskId] = useState<string | null>(null)
  const { data: tasks, isLoading } = trpc.tasks.byProject.useQuery(projectId)
  const utils = trpc.useUtils()

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.byProject.invalidate(projectId),
  })
  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => utils.tasks.byProject.invalidate(projectId),
  })

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!tasks?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-slate-400">
        <AlertCircle className="mb-2 h-7 w-7" />
        <p className="text-sm font-medium">No hay tareas</p>
        <Button size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Agregar tarea
        </Button>
        <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs text-slate-400">{tasks.length} tarea{tasks.length !== 1 ? 's' : ''}</span>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>

      {tasks.map(task => {
        const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
        const days = task.due_date ? daysUntil(task.due_date) : null
        const isOverdue = days !== null && days < 0 && task.status !== 'done' && task.status !== 'canceled'

        return (
          <div
            key={task.id}
            className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-slate-200 hover:bg-white transition-all"
          >
            <div className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`} />

            <span className="flex-1 text-sm text-slate-800 truncate">{task.title}</span>

            {task.due_date && (
              <span className={`hidden sm:flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                <Calendar className="h-3 w-3" />
                {isOverdue ? `${Math.abs(days!)}d vencida` : formatDate(task.due_date)}
              </span>
            )}

            {task.assignee && (
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {task.assignee.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}

            <div className="w-32 shrink-0">
              <Select
                value={task.status}
                onValueChange={val =>
                  updateTask.mutate({ id: task.id, status: val as TaskStatus })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_STATUS).map(([v, { label }]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <button
              onClick={() => { setEditTaskId(task.id); setEditOpen(true) }}
              className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-indigo-600 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => deleteTask.mutate(task.id)}
              className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}

      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
      <EditTaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        task={tasks?.find(t => t.id === editTaskId) ?? null}
      />
    </div>
  )
}
