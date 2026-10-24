'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EditTaskDialog } from './edit-task-dialog'
import { TaskDetailPanel } from './task-detail-panel'
import { PRIORITY } from '@/lib/utils'
import { Plus, Trash2, AlertCircle, Pencil } from 'lucide-react'
import type { TaskStatus } from '@/types/database'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { BlockedChip } from '@/components/ui/blocked-chip'
import { AddTaskDialog } from './add-task-dialog'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { MobileTaskRow, TaskActionsSheet, TaskCard, TaskEmpty, type RowTask } from '@/components/tasks/mobile-task-row'
import { ListChecks } from 'lucide-react'

const TASK_STATUS = {
  todo: { label: 'Por hacer', variant: 'secondary' as const },
  in_progress: { label: 'En progreso', variant: 'default' as const },
  in_review: { label: 'En revisión', variant: 'warning' as const },
  done: { label: 'Listo', variant: 'success' as const },
  canceled: { label: 'Cancelado', variant: 'danger' as const },
}

interface Props { projectId: string }

export function TaskList({ projectId }: Props) {
  const [editOpen, setEditOpen] = useState(false)
  const [editTaskId, setEditTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [moreTaskId, setMoreTaskId] = useState<string | null>(null)
  const { data: tasks, isLoading } = trpc.tasks.byProject.useQuery(projectId)
  const utils = trpc.useUtils()

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()]),
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => { toast.success('Tarea borrada'); void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()]) },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-border-soft animate-pulse" />
        ))}
      </div>
    )
  }

  const addButton = (
    <button
      type="button"
      onClick={() => setAddOpen(true)}
      className="inline-flex h-10 items-center gap-1.5 rounded-full bg-signal px-4 text-[13px] font-bold text-night active:opacity-90"
    >
      <Plus className="h-4 w-4" strokeWidth={2.6} /> Nueva tarea
    </button>
  )

  if (!tasks?.length) {
    return (
      <>
        <div className="hidden flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-graphite md:flex">
          <AlertCircle className="mb-2 h-7 w-7" />
          <p className="text-sm font-medium">No hay tareas</p>
          <p className="mt-1 text-xs text-graphite">
            Usa el atajo <kbd className="rounded border border-stone bg-surface px-1 py-0.5 font-mono text-[10px] text-graphite dark:border-ink-body dark:bg-night-700">N</kbd> o el botón + para agregar la primera.
          </p>
        </div>
        <div className="md:hidden">
          <TaskEmpty icon={<ListChecks />} title="Sin tareas todavía" hint="Agrega la primera para empezar a mover este proyecto." action={addButton} />
        </div>
        <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
      </>
    )
  }

  const moreTask = tasks.find(t => t.id === moreTaskId) ?? null

  return (
    <div className="space-y-1">
      {/* ─── Phones: iOS-style inset list with swipe actions ─── */}
      <div className="space-y-3 md:hidden">
        <div className="flex items-center justify-between">
          <span className="text-xs text-graphite">{tasks.length} tarea{tasks.length !== 1 ? 's' : ''}</span>
          {addButton}
        </div>
        <TaskCard>
          {tasks.map(task => (
            <MobileTaskRow
              key={task.id}
              task={task as unknown as RowTask}
              onOpen={() => setDetailTaskId(task.id)}
              onToggleDone={() => updateTask.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })}
              onMore={() => setMoreTaskId(task.id)}
            />
          ))}
        </TaskCard>
      </div>

      <div className="hidden md:block">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs text-graphite">{tasks.length} tarea{tasks.length !== 1 ? 's' : ''}</span>
      </div>

      {tasks.map(task => {
        const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
        const isDone = task.status === 'done' || task.status === 'canceled'

        return (
          <div
            key={task.id}
            className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-border hover:bg-surface transition-all cursor-pointer"
            onClick={() => setDetailTaskId(task.id)}
          >
            <div className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-stone'}`} />

            <span className="flex-1 text-sm text-foreground truncate inline-flex items-center gap-1.5">
              {task.title}
              <BlockedChip blocking={(task as unknown as { blocking: Parameters<typeof BlockedChip>[0]['blocking'] }).blocking} />
            </span>

            {task.due_date && (
              <span className="hidden sm:inline-flex">
                <DueDateChip date={task.due_date} isDone={isDone} variant="text" />
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
              onClick={(e) => { e.stopPropagation(); setEditTaskId(task.id); setEditOpen(true) }}
              className="flex md:hidden md:group-hover:flex h-6 w-6 items-center justify-center rounded text-graphite hover:text-signal-ink transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await confirmAction({
                  title: `Borrar tarea "${task.title}"`,
                  description: 'No se puede deshacer.',
                  variant: 'destructive',
                })
                if (ok) deleteTask.mutate(task.id)
              }}
              className="flex md:hidden md:group-hover:flex h-6 w-6 items-center justify-center rounded text-graphite hover:text-danger transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      </div>

      <TaskDetailPanel
        taskId={detailTaskId}
        projectId={projectId}
        onClose={() => setDetailTaskId(null)}
      />
      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
      <TaskActionsSheet
        open={!!moreTask}
        onClose={() => setMoreTaskId(null)}
        title={moreTask?.title ?? ''}
        status={moreTask?.status}
        onStatus={s => moreTask && updateTask.mutate({ id: moreTask.id, status: s })}
      >
        <InsetGroup>
          <ListRow
            title="Editar tarea"
            leading={<IconTile tone="neutral"><Pencil /></IconTile>}
            onClick={() => { if (moreTask) { setEditTaskId(moreTask.id); setEditOpen(true) } setMoreTaskId(null) }}
          />
          <ListRow
            title="Borrar tarea"
            destructive
            leading={<IconTile tone="danger"><Trash2 /></IconTile>}
            onClick={async () => {
              const t = moreTask
              setMoreTaskId(null)
              if (!t) return
              const ok = await confirmAction({ title: `Borrar tarea "${t.title}"`, description: 'No se puede deshacer.', variant: 'destructive' })
              if (ok) deleteTask.mutate(t.id)
            }}
          />
        </InsetGroup>
      </TaskActionsSheet>
      <EditTaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        task={tasks?.find(t => t.id === editTaskId) ?? null}
      />
    </div>
  )
}
