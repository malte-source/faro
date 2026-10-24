'use client'

import { useState } from 'react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { DocumentFromTaskButton } from '@/components/documentos/document-from-task-button'
import { TaskComments } from '@/components/tasks/task-comments'
import { TaskAttachments } from '@/components/tasks/task-attachments'
import { TaskDependencies } from '@/components/tasks/task-dependencies'
import { TaskReview } from '@/components/tasks/task-review'
import { TaskTimer } from '@/components/time/task-timer'
import { TaskCheck } from '@/components/tasks/mobile-task-row'
import { SelectRow, DateRow, SectionCard, useStableCallback } from '@/components/projects/mobile-bits'
import { Calendar, CheckCircle2, Circle, Clock, Flag, ListChecks, Trash2 } from 'lucide-react'
import { PRIORITY, cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'

const STATUS_OPTIONS = [
  { value: 'todo', label: 'Por hacer' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'done', label: 'Listo' },
  { value: 'canceled', label: 'Cancelado' },
]
const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
  { value: 'very_low', label: 'Muy baja' },
]
const STATUS_BADGE = { todo: 'secondary', in_progress: 'default', in_review: 'warning', done: 'success', canceled: 'danger' } as const

export interface DetailTask {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  estimated_hours?: number | null
  actual_hours?: number | null
  assignee?: { name: string; avatar_url: string | null } | null
  subtasks?: Array<{ id: string; title: string; status: string; priority: string }> | null
  drive_url?: string | null
  reviewer_id?: string | null
  review_state?: 'requested' | 'approved' | 'changes_requested' | null
}

/**
 * Task detail as a tall iOS-style sheet: tappable title, big checkbox, grouped
 * detail rows with native pickers, then self-contained cards (review, time,
 * dependencies, files, comments). The comment composer is pinned under the
 * scroll area so it rides above the on-screen keyboard.
 */
export function TaskDetailMobile({
  task, projectId, onClose, onUpdate, onDelete, deleting,
}: {
  task: DetailTask
  projectId: string
  onClose: () => void
  onUpdate: (patch: { title?: string; status?: TaskStatus; priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'; dueDate?: string | null }) => void
  onDelete: () => void
  deleting: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const stableClose = useStableCallback(onClose)
  const subtasks = task.subtasks ?? []
  const doneSubs = subtasks.filter(s => s.status === 'done').length
  const isDone = task.status === 'done' || task.status === 'canceled'
  const priority = PRIORITY[task.priority as keyof typeof PRIORITY]

  const commitTitle = () => {
    setEditing(false)
    const t = title.trim()
    if (t && t !== task.title) onUpdate({ title: t })
    else setTitle(task.title)
  }

  return (
    <BottomSheet
      open
      tall
      onClose={stableClose}
      footer={<div ref={setHost} />}
    >
      <div className="space-y-5 pb-2 pt-2">
        <div className="flex items-start gap-3 px-1">
          <div className="pt-1.5">
            <TaskCheck done={isDone} onToggle={() => onUpdate({ status: isDone ? 'todo' : 'done' })} />
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <textarea
                autoFocus
                rows={2}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
                  if (e.key === 'Escape') { setTitle(task.title); setEditing(false) }
                }}
                className="w-full resize-none rounded-[14px] border border-signal bg-surface px-3 py-2 font-display text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-foreground outline-none focus:ring-2 focus:ring-signal/30"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn('block w-full text-left font-display text-[24px] font-extrabold leading-[1.15] tracking-[-0.035em] text-foreground', isDone && 'text-graphite line-through decoration-graphite/50')}
                aria-label="Editar el título"
              >
                {task.title}
              </button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE[task.status as TaskStatus] ?? 'secondary'}>{STATUS_OPTIONS.find(o => o.value === task.status)?.label}</Badge>
              {priority && <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', priority.color)}><span className={cn('h-2 w-2 rounded-full', priority.dot)} />{priority.label}</span>}
            </div>
          </div>
        </div>

        <InsetGroup label="Detalles">
          <SelectRow label="Estado" value={task.status} onChange={v => onUpdate({ status: v as TaskStatus })} options={STATUS_OPTIONS} icon={<IconTile tone="neutral"><ListChecks /></IconTile>} />
          <SelectRow label="Prioridad" value={task.priority} onChange={v => onUpdate({ priority: v as 'very_high' | 'high' | 'medium' | 'low' | 'very_low' })} options={PRIORITY_OPTIONS} icon={<IconTile tone="neutral"><Flag /></IconTile>} />
          <DateRow label="Fecha límite" value={task.due_date?.split('T')[0] ?? ''} onChange={v => onUpdate({ dueDate: v || null })} icon={<IconTile tone="neutral"><Calendar /></IconTile>} />
          {task.assignee && (
            <ListRow
              title={task.assignee.name}
              subtitle="Responsable"
              leading={
                <Avatar className="h-9 w-9">
                  <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                  <AvatarFallback className="text-xs">{task.assignee.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              }
            />
          )}
          {(task.estimated_hours || task.actual_hours) && (
            <ListRow
              title="Horas"
              leading={<IconTile tone="neutral"><Clock /></IconTile>}
              trailing={<span className="tabular-nums">{task.estimated_hours ? `Est. ${task.estimated_hours} h` : ''}{task.estimated_hours && task.actual_hours ? ' · ' : ''}{task.actual_hours ? `Real ${task.actual_hours} h` : ''}</span>}
            />
          )}
        </InsetGroup>

        {subtasks.length > 0 && (
          <InsetGroup label={`Subtareas · ${doneSubs}/${subtasks.length}`}>
            {subtasks.map(st => (
              <ListRow
                key={st.id}
                title={<span className={cn(st.status === 'done' && 'text-graphite line-through')}>{st.title}</span>}
                leading={st.status === 'done' ? <CheckCircle2 className="h-6 w-6 text-success" /> : <Circle className="h-6 w-6 text-graphite/60" />}
              />
            ))}
          </InsetGroup>
        )}

        <SectionCard label="Revisión">
          <TaskReview taskId={task.id} driveUrl={task.drive_url ?? null} reviewerId={task.reviewer_id ?? null} reviewState={task.review_state ?? null} status={task.status} />
        </SectionCard>
        <SectionCard label="Documento">
          <DocumentFromTaskButton taskId={task.id} title={task.title} projectId={projectId} compact />
        </SectionCard>
        <SectionCard label="Tiempo"><TaskTimer taskId={task.id} /></SectionCard>
        <SectionCard label="Dependencias"><TaskDependencies taskId={task.id} projectId={projectId} /></SectionCard>
        <SectionCard label="Adjuntos"><TaskAttachments taskId={task.id} /></SectionCard>
        <SectionCard label="Comentarios"><TaskComments taskId={task.id} composerHost={host} /></SectionCard>

        <InsetGroup>
          <ListRow title="Eliminar tarea" destructive disabled={deleting} leading={<IconTile tone="danger"><Trash2 /></IconTile>} onClick={onDelete} />
        </InsetGroup>
      </div>
    </BottomSheet>
  )
}
