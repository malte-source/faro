'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PRIORITY } from '@/lib/utils'
import { X, Calendar, Clock, Trash2, GripHorizontal, CheckCircle2, Circle } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
  { value: 'very_low', label: 'Muy baja' },
]

function taskStatusVariant(s: TaskStatus): 'secondary' | 'default' | 'warning' | 'success' | 'danger' {
  return ({ todo: 'secondary', in_progress: 'default', in_review: 'warning', done: 'success', canceled: 'danger' } as const)[s]
}

interface Props {
  taskId: string | null
  projectId: string
  onClose: () => void
  queryKey?: 'byProject' | 'list'
}

export function TaskDetailPanel({ taskId, projectId, onClose, queryKey = 'byProject' }: Props) {
  const utils = trpc.useUtils()
  const { data: tasks } = trpc.tasks.byProject.useQuery(projectId, { enabled: !!projectId && queryKey === 'byProject' })
  const task = tasks?.find(t => t.id === taskId)

  const [title, setTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)

  useEffect(() => {
    if (task) setTitle(task.title)
  }, [task?.id, task?.title])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const update = trpc.tasks.update.useMutation({
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

  const del = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      onClose()
      utils.tasks.byProject.invalidate(projectId)
    },
  })

  if (!taskId || !task) return null

  const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
  const subtasks = (task.subtasks ?? []) as Array<{ id: string; title: string; status: string; priority: string }>

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel — slides in from the right */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[400px] flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <Badge variant={taskStatusVariant(task.status as TaskStatus)}>
            {TASK_STATUS_LABEL[task.status as TaskStatus]}
          </Badge>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (confirm('¿Eliminar esta tarea?')) del.mutate(task.id)
              }}
              disabled={del.isPending}
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="Eliminar tarea"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Title — click to edit inline */}
          {isEditingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title.trim() !== task.title) {
                  update.mutate({ id: task.id, title: title.trim() })
                }
                setIsEditingTitle(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { setTitle(task.title); setIsEditingTitle(false) }
              }}
              className="w-full rounded-lg border border-indigo-300 bg-indigo-50/30 px-3 py-2 text-base font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="w-full text-left text-base font-semibold leading-snug text-slate-900 hover:text-indigo-700 transition-colors"
              title="Clic para editar"
            >
              {task.title}
            </button>
          )}

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Estado</label>
              <Select
                value={task.status}
                onValueChange={val => update.mutate({ id: task.id, status: val as TaskStatus })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_STATUS_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Prioridad</label>
              <Select
                value={task.priority}
                onValueChange={val => update.mutate({ id: task.id, priority: val as 'very_high' | 'high' | 'medium' | 'low' | 'very_low' })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      <span className={`font-medium ${PRIORITY[value as keyof typeof PRIORITY]?.color}`}>{label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Calendar className="h-3.5 w-3.5" /> Fecha límite
            </label>
            <input
              type="date"
              value={task.due_date?.split('T')[0] ?? ''}
              onChange={e => update.mutate({ id: task.id, dueDate: e.target.value || null })}
              className="h-8 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Assignee */}
          {task.assignee && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Responsable</label>
              <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[11px]">
                    {task.assignee.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-slate-700">{task.assignee.name}</span>
              </div>
            </div>
          )}

          {/* Hours */}
          {(task.estimated_hours || task.actual_hours) && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Clock className="h-3.5 w-3.5" /> Horas
              </label>
              <div className="flex items-center gap-4 text-sm text-slate-600">
                {task.estimated_hours && (
                  <span><span className="text-slate-400">Est.</span> {task.estimated_hours}h</span>
                )}
                {task.actual_hours && (
                  <span><span className="text-slate-400">Real</span> {task.actual_hours}h</span>
                )}
              </div>
            </div>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Subtareas ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})
              </label>
              {/* Progress bar */}
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((subtasks.filter(s => s.status === 'done').length / subtasks.length) * 100)}%` }}
                />
              </div>
              <div className="space-y-2">
                {subtasks.map(st => (
                  <div key={st.id} className="flex items-start gap-2 text-sm">
                    {st.status === 'done'
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    }
                    <span className={st.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
