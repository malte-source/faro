'use client'

import { DocumentFromTaskButton } from '@/components/documentos/document-from-task-button'
import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PRIORITY } from '@/lib/utils'
import { X, Calendar, Clock, Trash2, GripHorizontal, CheckCircle2, Circle, MessageSquare } from 'lucide-react'
import { TaskComments } from '@/components/tasks/task-comments'
import { TaskAttachments } from '@/components/tasks/task-attachments'
import { TaskDependencies } from '@/components/tasks/task-dependencies'
import { TaskReview } from '@/components/tasks/task-review'
import { TaskTimer } from '@/components/time/task-timer'
import { TaskDetailMobile, type DetailTask } from '@/components/tasks/task-detail-mobile'
import { useIsMobile } from '@/components/mobile/use-media'
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
  const isMobile = useIsMobile()
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
    onSettled: () => void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()]),
  })

  const del = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      onClose()
      void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()])
    },
  })

  if (!taskId || !task) return null

  // Phones: a tall bottom sheet with grouped sections and a pinned comment composer.
  if (isMobile) {
    return (
      <TaskDetailMobile
        task={task as unknown as DetailTask}
        projectId={projectId}
        onClose={onClose}
        deleting={del.isPending}
        onUpdate={patch => update.mutate({ id: task.id, ...patch })}
        onDelete={async () => {
          const ok = await confirmAction({ title: `Borrar tarea "${task.title}"`, description: 'No se puede deshacer.', variant: 'destructive' })
          if (ok) del.mutate(task.id)
        }}
      />
    )
  }

  const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
  const subtasks = (task.subtasks ?? []) as Array<{ id: string; title: string; status: string; priority: string }>

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel:
       *  - Desktop (≥md): slides in from the right, fixed width 400px, full height.
       *  - Mobile (<md): bottom sheet — pinned to the bottom, full width, capped at
       *    90vh so the user can still see the top of the page; slides up from the
       *    bottom (much more thumb-friendly than a side drawer on phones).
       *  - The handle (small grey bar at the top) is only shown on mobile as a
       *    UX affordance hinting "swipe down or tap outside to close". */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl animate-in slide-in-from-bottom duration-200 md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:h-full md:max-h-none md:max-w-[400px] md:rounded-none md:slide-in-from-right">
        {/* Mobile drag handle (hidden on desktop) */}
        <div className="flex shrink-0 justify-center pt-2 md:hidden">
          <div className="h-1 w-10 rounded-full bg-stone dark:bg-ink-body" />
        </div>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-soft px-5 py-3.5">
          <Badge variant={taskStatusVariant(task.status as TaskStatus)}>
            {TASK_STATUS_LABEL[task.status as TaskStatus]}
          </Badge>
          <div className="flex items-center gap-1">
            <button
              onClick={async () => {
                const ok = await confirmAction({ title: `Borrar tarea "${task.title}"`, description: 'No se puede deshacer.', variant: 'destructive' })
                if (ok) del.mutate(task.id)
              }}
              disabled={del.isPending}
              className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger transition-colors"
              title="Eliminar tarea"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-graphite hover:bg-border-soft hover:text-body transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
        {/* Scrollable body */}
        <div className="px-5 py-5 space-y-5">
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
              className="w-full rounded-lg border border-signal/40 bg-signal-wash/30 px-3 py-2 text-base font-semibold text-foreground outline-none dark:bg-signal/10 focus:ring-2 focus:ring-signal/30"
            />
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="w-full text-left text-base font-semibold leading-snug text-foreground hover:text-foreground transition-colors"
              title="Clic para editar"
            >
              {task.title}
            </button>
          )}

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-graphite">Estado</label>
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
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-graphite">Prioridad</label>
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
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-graphite">
              <Calendar className="h-3.5 w-3.5" /> Fecha límite
            </label>
            <input
              type="date"
              value={task.due_date?.split('T')[0] ?? ''}
              onChange={e => update.mutate({ id: task.id, dueDate: e.target.value || null })}
              className="h-8 w-full rounded-md border border-border px-3 text-sm text-body focus:border-signal/50 focus:outline-none focus:ring-1 focus:ring-signal"
            />
          </div>

          {/* Assignee */}
          {task.assignee && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-graphite">Responsable</label>
              <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[11px]">
                    {task.assignee.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-body">{task.assignee.name}</span>
              </div>
            </div>
          )}

          {/* Hours */}
          {(task.estimated_hours || task.actual_hours) && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-graphite">
                <Clock className="h-3.5 w-3.5" /> Horas
              </label>
              <div className="flex items-center gap-4 text-sm text-graphite">
                {task.estimated_hours && (
                  <span><span className="text-graphite">Est.</span> {task.estimated_hours}h</span>
                )}
                {task.actual_hours && (
                  <span><span className="text-graphite">Real</span> {task.actual_hours}h</span>
                )}
              </div>
            </div>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-graphite">
                Subtareas ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})
              </label>
              {/* Progress bar */}
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-border-soft">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${Math.round((subtasks.filter(s => s.status === 'done').length / subtasks.length) * 100)}%` }}
                />
              </div>
              <div className="space-y-2">
                {subtasks.map(st => (
                  <div key={st.id} className="flex items-start gap-2 text-sm">
                    {st.status === 'done'
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone" />
                    }
                    <span className={st.status === 'done' ? 'line-through text-graphite' : 'text-body'}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Documento + Revisión */}
        <div className="border-t border-border-soft px-5 py-4">
          <TaskReview
            taskId={task.id}
            driveUrl={(task as { drive_url?: string | null }).drive_url ?? null}
            reviewerId={(task as { reviewer_id?: string | null }).reviewer_id ?? null}
            reviewState={(task as { review_state?: 'requested' | 'approved' | 'changes_requested' | null }).review_state ?? null}
            status={task.status}
          />
        </div>

        {/* Documento redactado con IA a partir de esta tarea */}
        <div className="border-t border-border-soft px-5 py-4">
          <DocumentFromTaskButton taskId={task.id} title={task.title} projectId={projectId} compact />
        </div>

        {/* Time tracking */}
        <div className="border-t border-border-soft px-5 py-4">
          <TaskTimer taskId={task.id} />
        </div>

        {/* Dependencies */}
        <div className="border-t border-border-soft px-5 py-4">
          <TaskDependencies taskId={task.id} projectId={projectId} />
        </div>

        {/* Attachments */}
        <div className="border-t border-border-soft px-5 py-4">
          <TaskAttachments taskId={task.id} />
        </div>

        {/* Comments */}
        <div className="border-t border-border-soft px-5 py-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-graphite">
            <MessageSquare className="h-3 w-3" /> Comentarios
          </p>
          <TaskComments taskId={task.id} />
        </div>
        </div>
      </div>
    </>
  )
}
